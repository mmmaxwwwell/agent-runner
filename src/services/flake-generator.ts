import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type DetectedStack = 'node' | 'python' | 'rust' | 'go' | 'generic';

const ARCH_MAP: Record<string, string> = {
  x64: 'x86_64',
  arm64: 'aarch64',
};

const PLATFORM_MAP: Record<string, string> = {
  linux: 'linux',
  darwin: 'darwin',
};

/**
 * Detect the Nix system string from the current architecture and platform.
 * Falls back to x86_64-linux for unknown combinations.
 */
export function detectArch(arch?: string, platform?: string): string {
  const a = arch ?? process.arch;
  const p = platform ?? process.platform;
  const nixArch = ARCH_MAP[a];
  const nixPlatform = PLATFORM_MAP[p];
  if (nixArch && nixPlatform) return `${nixArch}-${nixPlatform}`;
  return 'x86_64-linux';
}

/**
 * Detect the primary tech stack of a project directory by checking for
 * common manifest files.
 */
export function detectStack(dirPath: string): DetectedStack {
  if (existsSync(join(dirPath, 'package.json'))) return 'node';
  if (existsSync(join(dirPath, 'Cargo.toml'))) return 'rust';
  if (existsSync(join(dirPath, 'go.mod'))) return 'go';
  // Python: check multiple manifest files
  if (
    existsSync(join(dirPath, 'pyproject.toml')) ||
    existsSync(join(dirPath, 'requirements.txt')) ||
    existsSync(join(dirPath, 'setup.py'))
  ) return 'python';
  return 'generic';
}

/**
 * Detect the Node.js major version from package.json engines field.
 * Falls back to 22 (current LTS).
 */
function detectNodeVersion(dirPath: string): number {
  try {
    const pkg = JSON.parse(readFileSync(join(dirPath, 'package.json'), 'utf-8'));
    const engines = pkg.engines?.node;
    if (typeof engines === 'string') {
      // Extract major version from patterns like ">=18", "^20", "22.x", ">=18.0.0"
      const match = engines.match(/(\d+)/);
      if (match) return parseInt(match[1], 10);
    }
  } catch {
    // Fall through to default
  }
  return 22;
}

function nodeVersionPackage(major: number): string {
  if (major >= 22) return 'nodejs_22';
  if (major >= 20) return 'nodejs_20';
  if (major >= 18) return 'nodejs_18';
  return 'nodejs_22'; // default to latest LTS
}

function flakeShell(packages: string): string {
  const system = detectArch();
  return `{
  description = "Development shell";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      system = "${system}";
      pkgs = nixpkgs.legacyPackages.\${system};
    in
    {
      devShells.\${system}.default = pkgs.mkShell {
        packages = with pkgs; [
          ${packages}
        ];
      };
    };
}
`;
}

const FLAKE_TEMPLATES: Record<DetectedStack, (dirPath: string) => string> = {
  node: (dirPath) => {
    const major = detectNodeVersion(dirPath);
    const pkg = nodeVersionPackage(major);
    return flakeShell(pkg);
  },

  python: () => flakeShell(`python312
          uv`),

  rust: () => flakeShell(`rustc
          cargo
          rustfmt
          clippy`),

  go: () => flakeShell('go'),

  generic: () => flakeShell(''),
};

/**
 * Generate a flake.nix content string for the given directory based on detected stack.
 */
export function generateFlakeContent(dirPath: string): string {
  const stack = detectStack(dirPath);
  return FLAKE_TEMPLATES[stack](dirPath);
}

/**
 * Ensure a project directory has a flake.nix. If one already exists, does nothing.
 * Returns true if a flake.nix was generated, false if one already existed.
 */
export function ensureFlakeNix(dirPath: string): boolean {
  const flakePath = join(dirPath, 'flake.nix');
  if (existsSync(flakePath)) return false;
  const content = generateFlakeContent(dirPath);
  writeFileSync(flakePath, content, 'utf-8');
  return true;
}
