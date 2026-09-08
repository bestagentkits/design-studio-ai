import { editMesh, type MeshEdit } from '../src/shared/mesh-editing';
import type { MeshData } from '../src/shared/design-capabilities';
self.onmessage = (event: MessageEvent<{ mesh: MeshData; edit: MeshEdit }>) => {
  try { self.postMessage({ mesh: editMesh(event.data.mesh, event.data.edit) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Geometry operation failed' }); }
};
