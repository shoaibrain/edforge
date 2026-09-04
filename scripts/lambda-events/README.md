# Recorded API Gateway (REST, proxy v1) events

Fixtures for the Lambda entries (`microservices/<svc>/src/lambda.ts`), used by
the handler specs (C1.3), `scripts/invoke-local.ts` (C1.5) and the direct-invoke
smoke (C1.8). `${ID_TOKEN}` / `${SCHOOL_ID}` placeholders are substituted from the
environment by the invoke tooling; never commit a real token here.
