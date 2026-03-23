# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.0.0-rc.1] - 2026-03-23

### Added
- `Database` class with connection pooling, typed query methods, transaction management, and LISTEN/NOTIFY support
- `TransactionClient` for scoped transaction execution (extends `Database`)
- `API<DB>` abstract base class for repository/service pattern
- Type-safe column definitions: `varchar`, `decimal`, `numeric`, `float`, `boolean`, `date`, `datetime`, `required`
- Type inference utilities: `InputType<T>`, `OutputType<T>`, `AutoColumns<T>`, `JSType<K>`
- Table management: `createTable`, `createIndexes`, `alterColumn`, `insertIntoTable`, `bulkWrite`, `tableOutput`
- Query modes: `select`, `execute`, `first`, streaming via `{ stream: true }`, cursor-based `chunks` and `step`
- SQL template literal support with type-safe table/view/function interpolation
- Per-pool type parser overrides via the `types` constructor option

### Changed
- Type parsers are now configured per pool instance via the `types` constructor option instead of global `pg.types.setTypeParser` calls

### Removed
- `configure()` function — replaced by the per-pool `types` constructor option
