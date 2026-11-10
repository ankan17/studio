// Test helper: saves a growing project in a tight loop until it is killed.
import {ProjectStore} from "./index";

const [root, id] = process.argv.slice(2) as [string, string];
const store = new ProjectStore(root, {snapshotEveryMs: 20});
const {project} = await store.open(id);
process.stdout.write("ready\n");
for (let i = 0; ; i++) {
  const markers = Array.from({length: 2000}, (_, k) => ({id: `m${k}`, frame: k, label: `marker ${i} ${k}`}));
  await store.save({...project, name: `save ${i}`, markers});
}
