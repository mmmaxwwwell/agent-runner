{
  description = "Agent Runner — server + PWA for running agent-framework projects";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
    in
    {
      devShells.${system}.default = pkgs.mkShell {
        packages = with pkgs; [
          nodejs_22
          nodePackages.typescript
          nodePackages.typescript-language-server
          uv
          python312
        ];

        shellHook = ''
          echo "agent-runner dev shell — node $(node --version), uv $(uv --version)"
        '';
      };
    };
}
