# Change Log

All notable changes to the "json-lines-viewer" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.0.6] - 2026-10-10

### Fixed
- Open `.jsonl`, `.jl` and `.ndjson` previews regardless of JSON/Plain Text language mode.
- Reuse previews when the preview command is run again inside a preview.
- Preserve Windows paths, special filename characters and remote URI authorities.
- Index actual bytes so CRLF and multibyte UTF-8 records are read at correct offsets.
- Keep navigation available after blank, empty, malformed or inaccessible records.

### Added
- File selection when the active editor is unrelated, and preview from the source cursor.
- Preview unsaved buffers and edits; refresh after source changes and saves.
- Refresh command, clickable line status and positive integer validation for line jumps.
- Regression tests for the indexed reader and real VSCode preview commands.

### Changed
- Build sparse byte indices lazily instead of scanning the entire file before its first preview.
- Limit cached files, close streams after each read and prevent stale asynchronous navigation.
- Label the locally installed package as the moolean fork while keeping its extension ID.

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
