const scripts = new Map<string, Promise<void>>();
export function loadScript(src: string, id: string): Promise<void> {
  const existing = scripts.get(id); if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script"); script.id = id; script.src = src; script.async = true;
    script.onload = () => resolve(); script.onerror = () => { scripts.delete(id); script.remove(); reject(new Error("외부 화면을 불러오지 못했어요.")); };
    document.head.appendChild(script);
  });
  scripts.set(id, promise); return promise;
}
