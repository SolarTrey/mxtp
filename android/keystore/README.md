# mxtp sideload signing key

`mxtp-sideload.jks` signs the mxtp.apk built on GitHub, so each new version installs over the last one.

It's public, so it's only meant for installing mxtp yourself. Before publishing to Google Play or anywhere else,
make a private key and give the build these environment variables (for example as GitHub Actions secrets):
`MXTP_KEYSTORE` (path to the .jks), `MXTP_KEY_ALIAS`, `MXTP_KEY_PASSWORD`.
