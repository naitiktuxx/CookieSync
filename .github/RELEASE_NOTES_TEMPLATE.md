# CookieSync v0.1.0

Initial public release.

## Added
- Cross-browser encrypted cookie sync
- Chromium Host extension
- Firefox Receiver extension
- AES-256-GCM encryption for synced data
- Offline encrypted export and import (.cokz)
- Manual and scheduled sync
- Activity log
- Theme support
- Settings backup and restore
- Domain allowlist support

## Changed
- Added automated release packaging
- Added GitHub Release workflow
- Added SHA256 checksum generation
- Updated installation instructions
- Added GitHub CLI release documentation
- Added release badges to README
- Cleaned production build output

## Fixed
- Various stability improvements
- Improved configuration validation
- Improved version consistency checks during packaging

## Security
- Release packages now contain only runtime files
- Added checksum verification for release assets
- Improved release validation before publishing

## Downloads
- CookieSync-Chromium-Host-v0.1.0.zip
- CookieSync-Firefox-Receiver-v0.1.0.xpi
- SHA256SUMS.txt
