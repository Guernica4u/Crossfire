const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("data/crossfire.db");
db.prepare("DELETE FROM turns WHERE status IN ('interrupted', 'error') AND trim(content) = ''").run();
db.prepare("UPDATE debates SET status = 'active' WHERE status IN ('paused', 'error') AND phase != 'complete'").run();
const rows = db.prepare("SELECT seq, status, length(content) AS len FROM turns ORDER BY seq").all();
console.log(JSON.stringify(rows));
