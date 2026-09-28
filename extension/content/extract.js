globalThis.__anExtract = () => {
  const title = document.title || "";
  const url = location.href;
  const pick = document.querySelector("main, article, [role=main]") || document.body;
  let text = (pick?.innerText || document.body.innerText || "").replace(/\n{3,}/g, "\n\n");
  return { title, url, text: text.slice(0, 20000), truncated: text.length > 20000 };
};
