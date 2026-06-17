# `@dudousxd/nestjs-context` — DESIGN

> Status: spec (impl pendente). Parte da Fase 0 do `../ECOSYSTEM-AUDIT.md`. Base do `nestjs-authz`.

## 1. O que é (papel × distribuição)

ALS (AsyncLocalStorage) **compartilhado** que carrega `user`/`tenant`/`traceId` e flui por todas as libs do ecossistema.

- **Papel:** plumbing/infra — o dev quase não chama direto; quem consome são as outras libs (audit lê `userRef()`, filter lê `tenantId()`, telescope/durable correlacionam por `traceId()`).
- **Distribuição:** **pública e publicada** (`@dudousxd/nestjs-context`). É **optional peer dependency** das outras libs (elas precisam poder resolvê-la) e tem API própria que o app usa direto. Análogo: `Context` do Laravel 11 / `HttpContext` do Adonis. Tipo o `reflect-metadata` do ecossistema: todo mundo depende, quase ninguém chama na mão.
- **Valor standalone:** vale mesmo sem outra lib — "current user/tenant sem `@Inject(REQUEST)` nem provider request-scoped".

## 2. Núcleo (espelha `telescope-context.ts` + `filterAls`)

Singleton de módulo (necessário p/ ser lido FORA da DI: watchers, ORM subscribers, durable worker):

```ts
// store ABERTO p/ extensão via module augmentation
export interface ContextStore {
  traceId: string;
  requestId?: string;
  userRef?: { type: string; id: string | number };
  tenantId?: string;
}
// libs estendem:  declare module '@dudousxd/nestjs-context' { interface ContextStore { ... } }

const als = new AsyncLocalStorage<ContextStore>();

export const Context = {
  run<T>(store: ContextStore, fn: () => T): T { return als.run(store, fn); },
  enterWith(store: ContextStore): void { als.enterWith(store); },  // sobrevive ao return do middleware
  get(): ContextStore | undefined { return als.getStore(); },
  set<K extends keyof ContextStore>(k: K, v: ContextStore[K]): void { const s = als.getStore(); if (s) s[k] = v; },
  traceId: () => als.getStore()?.traceId,
  tenantId: () => als.getStore()?.tenantId,
  userRef: () => als.getStore()?.userRef,
  // cross-boundary (ver §5)
  serialize(): ContextCarrier | undefined { /* { traceId, tenantId, userRef } */ },
  deserialize<T>(c: ContextCarrier, fn: () => T): T { /* als.run(fromCarrier(c), fn) */ },
};
```

**Decisão:** carrega `userRef` (`{type,id}`), **não** o objeto user inteiro — mesmo padrão do `toNotifiableRef()` do notifications. É o que torna o store serializável (§5).

## 3. Setar (entrada HTTP)

`enterWith` (não `run`) — mesmo motivo do `telescope-context.enterWith`: precisa sobreviver ao return do middleware e alcançar handler async + interceptors.

```ts
@Injectable()
export class ContextMiddleware implements NestMiddleware {
  use(req, _res, next) {
    Context.enterWith({
      traceId: extractTraceparent(req.headers) ?? randomTraceId(),
      requestId: req.headers['x-request-id'],
    });
    next();  // user/tenant entram DEPOIS, via Context.set() no guard de auth
  }
}
```

## 4. Wiring (convenção `forRoot`, módulo global)

```ts
export interface ContextModuleOptions {
  // população (nível 2)
  traceHeader?: string;                                  // header do traceId de entrada
  traceId?: (req: any) => string;                        // override da geração do traceId
  initialize?: (req: any) => Partial<ContextStore>;      // preenche campos custom no boot do request
  // entrypoint (nível 3)
  autoMiddleware?: boolean;                              // default true; false = você cria o contexto (não-HTTP)
  forRoutes?: any[];                                     // default ['*']
  exclude?: any[];                                       // rotas sem contexto
  // cross-process (nível 4)
  carrier?: (keyof ContextStore)[];                      // default ['traceId','tenantId','userRef']
  serialize?: (s: ContextStore) => ContextCarrier;       // override total (com deserialize)
  deserialize?: (c: ContextCarrier) => ContextStore;
}

export class ContextModule {
  static forRoot(opts?: ContextModuleOptions): DynamicModule { /* global:true; middleware se autoMiddleware */ }
}
```

Expõe token `CONTEXT_ACCESSOR` (global) p/ as outras libs injetarem opcional (§6).

## 4.1 Customização — plug-n-play, mas totalmente customizável (CONTRATO)

5 níveis, do mais comum ao avançado. Defaults sãos; nada obrigatório.

**Nível 1 — campos próprios (module augmentation, tipado):**
```ts
declare module '@dudousxd/nestjs-context' {
  interface ContextStore { locale?: string; impersonatorId?: string }
}
```

**Nível 2 — popular campos / trocar geração do traceId** (hooks no forRoot):
```ts
ContextModule.forRoot({
  traceId: (req) => req.headers['x-correlation-id'] ?? randomTraceId(),
  initialize: (req) => ({ locale: parseAcceptLanguage(req), tenantId: tenantFromSubdomain(req) }),
});
```
O middleware aplica `traceId(req)` (ou `traceHeader`/random) e faz merge de `initialize(req)` no store inicial. user/tenant continuam podendo entrar depois via `Context.set()` no guard de auth.

**Precedência (importante):** o `initialize(req)` é mergeado **PRIMEIRO**; só depois o middleware seta `traceId` (do hook/header/random) e `requestId` (do header `x-request-id`). Ou seja, o `traceId` resolvido e o `requestId` **sempre vencem** — um campo solto retornado por `initialize()` não consegue sobrescrevê-los. Um `requestId` vazio (string `''`) é tratado como ausente. Se `initialize()` retornar `requestId` e não houver header, o valor de `initialize()` persiste.

**Nível 3 — entrypoint não-HTTP (GraphQL/gRPC/fila):** middleware HTTP é só o default. Desliga e cria o contexto você mesmo com o primitivo público:
```ts
ContextModule.forRoot({ autoMiddleware: false });
// no seu interceptor/guard/consumer:
Context.run({ traceId, userRef }, () => next());
```
(`forRoutes`/`exclude` cobrem o caso HTTP parcial.)

**Nível 4 — o que sobrevive cross-process** (carrier): default serializa `traceId/tenantId/userRef`. Pra um campo custom (nível 1) sobreviver ao BullMQ/durable:
```ts
ContextModule.forRoot({ carrier: ['traceId','tenantId','userRef','locale'] });
// ou override total: serialize/deserialize próprios
```

> **Config é PROCESS-GLOBAL.** O par `carrier`/`serialize`/`deserialize` vive num singleton de módulo (fora da DI, pra ser lido por watchers/worker/etc), então é **compartilhado por todo o processo**. Cada `ContextModule.forRoot` **substitui a config inteira** (não faz merge) — as opções de um `forRoot` são tratadas como a config completa, garantindo que você nunca pareie o `serialize` de um app com o `deserialize` de outro. Um **2º `forRoot` com config diferente emite `console.warn`** (o último vence). Em cenários multi-app (um processo, vários apps Nest) ou em suítes de teste, chame `Context.resetConfig()` entre apps/testes pra voltar aos defaults.

> **`deserialize`/`fromCarrier` blinda o `traceId`:** um carrier cross-process que chegue sem `traceId` (falsy) faz gerar um `randomTraceId()` (com `console.warn` uma vez), preservando a invariante `ContextStore.traceId: string` que telescope/durable usam.

**Nível 5 — trocar o accessor que as libs consomem** (avançado, via DI): `CONTEXT_ACCESSOR` é token, então dá override:
```ts
{ provide: CONTEXT_ACCESSOR, useClass: MyCustomAccessor }   // ex.: resolve o user completo, não só userRef
```

| Nível | Como | Default |
|---|---|---|
| 1 campos | module augmentation | — |
| 2 popular/traceId | `initialize`/`traceId` no forRoot | traceHeader→random |
| 3 não-HTTP | `autoMiddleware:false` + `Context.run` | middleware `*` |
| 4 carrier | `carrier:[]` / `serialize` override | traceId+tenantId+userRef |
| 5 accessor | override do token `CONTEXT_ACCESSOR` | accessor padrão |

## 5. Cross-boundary (a parte difícil — o que justifica a lib)

ALS não atravessa processo/fila/durable sozinho. `serialize()` → carrier plano `{ traceId, tenantId, userRef }` (nada de user/conexão). A integração mora **no lado de quem já produz o boundary**, guardada por detecção opcional — **não** em pacotes-ponte `nestjs-context-bullmq`/`-durable` que o dev instale:

- **BullMQ** (dentro do dispatcher de quem enfileira): `queue.add(name, { ...payload, __ctx: Context.serialize() })`; no worker `Context.deserialize(job.data.__ctx, () => handler(job))`.
- **Durable**: liga no gancho que **já existe** — `WorkflowEngine({ traceparent: () => toTraceparent(Context.traceId()) })`; `RemoteTask` carrega o carrier; worker (incl. Python) re-hidrata. (PR no durable p/ carrier levar tenant/userRef além do traceparent.)

> Pegadinha a documentar: workflow de dias — o user/tenant do carrier é o de quando **disparou**; se mudou, o step re-hidrata o histórico, não o atual. Decisão: carrier é snapshot, não live.

## 6. Como as libs consomem (zero fiação do dev)

Detecção via DI opcional — `@Optional() @Inject` no token global:

```ts
@Injectable()
export class AuditService {
  constructor(@Optional() @Inject(CONTEXT_ACCESSOR) private ctx?: ContextAccessor) {}
  log(changes) {
    return { causer: this.ctx?.userRef(), traceId: this.ctx?.traceId(), changes };  // degrada limpo se ausente
  }
}
```

**Regra do ecossistema:** integração mora no lado de quem já tem o import. Consumidor lê via `@Optional()`; produtor (durable/bullmq) carrega o carrier se presente. Dev faz no máximo 1 import (`ContextModule.forRoot()`) — 0 com `nestjs-kit` ou se telescope (que já roda por request) for o dono da criação.

## 7. Pacotes
- `@dudousxd/nestjs-context` — núcleo (ALS + middleware + module + serialize/deserialize)
- `@dudousxd/nestjs-context-testing` — helper p/ rodar código num store fake

## 8. Não-objetivos
- Não faz auth (não cria/loga user). Só carrega o que outra camada resolveu.
- Não persiste nada (sem tabela; §3.10 do audit não se aplica).
- Não gerencia conexão de banco.
