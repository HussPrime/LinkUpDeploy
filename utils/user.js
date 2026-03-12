export function splitName(name = "") {
  const trimmed = String(name || "").trim();
  if (!trimmed) return { first_name: "", last_name: "" };
  const parts = trimmed.split(/\s+/).filter(Boolean);
  const first_name = parts.shift() || "";
  const last_name = parts.join(" ");
  return { first_name, last_name };
}

export function dbUserToAppUser(row) {
  if (!row) return null;
  const { first_name, last_name } = splitName(row.name || "");
  return {
    id: row.id,
    email: row.email || null,
    first_name,
    last_name,
    avatar_url: row.image || null
  };
}

export function dbUserToProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    filiere: row.filiere ?? "",
    annee_etude: row.annee_etude ?? "",
    bio: row.bio ?? "",
    centres_interet: row.centres_interet ?? ""
  };
}

export function isProfileComplete(row) {
  const filiere = (row?.filiere ?? "").trim();
  const annee = (row?.annee_etude ?? "").trim();
  return Boolean(filiere && annee);
}
