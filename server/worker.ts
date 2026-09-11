import { app } from './index';
import { createWorkersConnectorFetch } from './connector-transport';
import type { Bindings } from './types';

// Runtime composition is server-owned. A connector request cannot choose a private binding.
export default {
  fetch(request: Request, env: Bindings, context: Parameters<typeof app.fetch>[2]) {
    return app.fetch(request, { ...env, CONNECTOR_FETCH: createWorkersConnectorFetch() }, context);
  },
};
