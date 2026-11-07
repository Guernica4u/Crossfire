const id = process.argv[2];

(async () => {
  const started = Date.now();
  const res = await fetch(`http://localhost:3000/api/debates/${id}/judge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const text = await res.text();
  console.log(
    JSON.stringify({
      ms: Date.now() - started,
      status: res.status,
      body: text.slice(0, 2500),
    }),
  );
})();
