import { getUser, login, verifyRequestOrigin } from "@netlify/identity";
import { getAccessProfile, markReauthenticated, publicAccessProfile } from "./access.mjs";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" },
  });
}

export default async function auth(request) {
  const user = await getUser();

  if (request.method === "GET") {
    if (!user) return json({ user: null });
    const access = await getAccessProfile(user);
    return json({
      user: { id: user.id, email: user.email, name: user.name || "" },
      access: publicAccessProfile(access),
    });
  }

  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    verifyRequestOrigin(request);
  } catch {
    return json({ error: "This request must come from the Larder report app." }, 403);
  }
  if (!user?.email) return json({ error: "Please sign in again." }, 401);

  const body = await request.json().catch(() => ({}));
  if (body.action !== "reauthenticate" || typeof body.password !== "string") return json({ error: "Invalid request." }, 400);

  try {
    await login(user.email, body.password);
    await markReauthenticated(user.id);
    return json({ message: "Sensitive access confirmed for five minutes." });
  } catch {
    return json({ error: "That password is not correct." }, 401);
  }
}
