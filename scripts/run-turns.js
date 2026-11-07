const id = process.argv[2];
const count = Number(process.argv[3] ?? 1);

function parseSse(raw) {
  return raw
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      let event = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      let payload = null;
      try {
        payload = JSON.parse(data);
      } catch {
        payload = null;
      }
      return { event, payload };
    });
}

async function runTurn() {
  const started = Date.now();
  const res = await fetch(`http://localhost:3000/api/debates/${id}/turn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const raw = await res.text();
  const events = parseSse(raw);
  const meta = events.find((e) => e.event === "meta")?.payload;
  const done = events.find((e) => e.event === "done")?.payload;
  const error = events.find((e) => e.event === "error")?.payload;
  const tokens = events.filter((e) => e.event === "token").map((e) => e.payload?.text ?? "").join("");
  return {
    ms: Date.now() - started,
    httpStatus: res.status,
    speaker: meta?.agentName,
    model: meta?.model,
    status: events.filter((e) => e.event === "status").map((e) => e.payload?.message),
    error,
    textLength: tokens.length,
    preview: tokens.slice(0, 260),
    next: done
      ? {
          phase: done.view?.debate?.phase,
          round: done.view?.debate?.round,
          speakerIndex: done.view?.debate?.nextSpeakerIndex,
          turns: done.view?.turns?.length,
          needsJudge: done.needsJudge,
        }
      : null,
  };
}

(async () => {
  for (let i = 0; i < count; i += 1) {
    const result = await runTurn();
    console.log(JSON.stringify(result));
    if (result.error || !result.next || result.next.needsJudge) break;
  }
  const view = await (await fetch(`http://localhost:3000/api/debates/${id}`)).json();
  console.log(
    JSON.stringify({
      final: view.view.debate.status,
      phase: view.view.debate.phase,
      round: view.view.debate.round,
      next: view.view.debate.nextSpeakerIndex,
      turns: view.view.turns.length,
    }),
  );
})();
