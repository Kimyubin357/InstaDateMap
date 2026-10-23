let id: string | undefined;
/** One registration owner per tab, retained through the add -> confirm navigation. */
export function workId() {
  if (id) return id;
  try {
    id = sessionStorage.getItem("datemap-work") || crypto.randomUUID();
    sessionStorage.setItem("datemap-work", id);
  } catch { id = crypto.randomUUID(); }
  return id;
}
