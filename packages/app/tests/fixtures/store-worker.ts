import { parseState } from "../../../core/src/state";
import { createProjectStore } from "../../src/store";

/** Usage: tsx store-worker.ts <db> <projectId> <tag> <count> */
const [dbPath, projectId, tag, count] = process.argv.slice(2);
const state = parseState({
  version: 1,
  nodes: [{ id: `svc-${tag}`, kind: "service", name: `Service ${tag}` }],
});

const store = createProjectStore({ path: dbPath });
try {
  for (let index = 0; index < Number(count); index += 1) {
    if (!store.addRevision(projectId, { state, message: `${tag}-${index}` })) {
      throw new Error(`project disappeared: ${projectId}`);
    }
  }
} finally {
  store.close();
}
