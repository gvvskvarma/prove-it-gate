# Security

prove-it runs as local hook commands. It reads hook payloads from stdin and reads `.prove-it.json` and project manifests (`package.json`, etc.) in the working directory. It writes only to the plugin data directory, or the OS temp directory if that is not set. It makes no network calls, uses no `eval`, and has no runtime dependencies.

Report vulnerabilities through GitHub private vulnerability reporting on this repository.
