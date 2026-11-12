# @dudousxd/nestjs-context-testing

## 2.0.0

### Major Changes

- [#109](https://github.com/DavideCarvalho/nestjs-context/pull/109) [`f2fa595`](https://github.com/DavideCarvalho/nestjs-context/commit/f2fa595b7da748354e8675f30f56a9cc92f4120d) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - **Breaking:** require Node.js 24 or newer (`engines.node` is now `>=24`, was `>=20`). CI tests on Node 24 and 26. No API changes: see the Upgrading page in the docs.

### Patch Changes

- Updated dependencies [[`f2fa595`](https://github.com/DavideCarvalho/nestjs-context/commit/f2fa595b7da748354e8675f30f56a9cc92f4120d)]:
  - @dudousxd/nestjs-context@2.0.0

## 1.0.2

### Patch Changes

- [#8](https://github.com/DavideCarvalho/nestjs-context/pull/8) [`680aa63`](https://github.com/DavideCarvalho/nestjs-context/commit/680aa63731982560cccb12a7ab5b19a355cdb051) Thanks [@DavideCarvalho](https://github.com/DavideCarvalho)! - Ship TanStack Intent agent skills (SKILL.md) inside the package.

## 1.0.0

### Patch Changes

- Updated dependencies [[`d7d038c`](https://github.com/DavideCarvalho/nestjs-context/commit/d7d038c339eb4fdbdf01c0dd4b10a8b9df4a6fe9)]:
  - @dudousxd/nestjs-context@1.0.0

## 0.2.0

### Patch Changes

- Updated dependencies [[`f1c4f5c`](https://github.com/DavideCarvalho/nestjs-context/commit/f1c4f5c20df05b156da2bc9da63caa46aa6cfebf)]:
  - @dudousxd/nestjs-context@0.2.0

## 0.1.0

### Minor Changes

- [`a2d5869`](https://github.com/DavideCarvalho/nestjs-context/commit/a2d5869455e83f45fb23eed649513813465be151) - Initial release: shared AsyncLocalStorage context (`Context` singleton + `ContextStore`), W3C traceparent helpers, `ContextMiddleware`, global `ContextModule.forRoot()` with the `CONTEXT_ACCESSOR` token, and the `@dudousxd/nestjs-context-testing` helper (`runWithContext`).
