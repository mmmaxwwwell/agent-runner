{
  description = "Agent Runner — server + PWA for running agent-framework projects";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs {
        inherit system;
        config = {
          allowUnfree = true;
          android_sdk.accept_license = true;
        };
      };
      androidComposition = pkgs.androidenv.composeAndroidPackages {
        platformVersions = [ "34" ];
        buildToolsVersions = [ "34.0.0" ];
        includeEmulator = false;
        includeSources = false;
        includeSystemImages = false;
      };
      androidSdk = androidComposition.androidsdk;
    in
    {
      devShells.${system}.default = pkgs.mkShell {
        packages = with pkgs; [
          nodejs_22
          nodePackages.typescript
          nodePackages.typescript-language-server
          uv
          python312
          # Android development
          gradle
          jdk17
          androidSdk
        ];

        JAVA_HOME = "${pkgs.jdk17}/lib/openjdk";
        ANDROID_HOME = "${androidSdk}/libexec/android-sdk";

        shellHook = ''
          echo "agent-runner dev shell — node $(node --version), uv $(uv --version), java $(java -version 2>&1 | head -1)"

          # Generate Gradle wrapper in android/ if missing
          if [ ! -f android/gradlew ]; then
            echo "Generating Gradle wrapper in android/..."
            (cd android && gradle wrapper --gradle-version 8.5 --quiet 2>/dev/null || true)
          fi
        '';
      };
    };
}
