const scripts = new Map<string, Promise<void>>();
export function forgetScript(id: string) {
  scripts.delete(id);
  document.getElementById(id)?.remove();
}
export function loadScript(src: string, id: string): Promise<void> {
  const existing = scripts.get(id); if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script"); script.id = id; script.src = src; script.async = true;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true; clearTimeout(timer); script.onload = null; script.onerror = null;
      if (error) { scripts.delete(id); script.remove(); reject(error); } else resolve();
    };
    const timer = setTimeout(() => finish(new Error("외부 화면을 불러오는 시간이 길어졌어요.")), 15000);
    script.onload = () => finish(); script.onerror = () => finish(new Error("외부 화면을 불러오지 못했어요."));
    document.head.appendChild(script);
  });
  scripts.set(id, promise); return promise;
}
