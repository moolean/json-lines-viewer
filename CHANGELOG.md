# Change Log

All notable changes to the "json-lines-viewer" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.0.5] - 2025-10-30

### Added
- Large file support with minimal memory overhead
- Intelligent line position caching for fast navigation
- Sampling strategy for files > 10MB (caches every 100th line)
- File modification detection to keep cache in sync

### Changed
- Improved line reading performance - no longer reads from beginning of file
- Reduced memory usage for large files to ~1% of previous implementation

## [Unreleased]

- Initial release