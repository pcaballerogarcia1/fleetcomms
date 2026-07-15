const TO_EMAIL = "p.caballerogarcia1@gmail.com";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { name, company, email, message } = req.body || {};
  if (!name || !email || !message) {
    return res.status(400).json({ error: "Faltan campos obligatorios" });
  }

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Operanzia <onboarding@resend.dev>",
        to: [TO_EMAIL],
        reply_to: email,
        subject: `Contacto Operanzia — ${company || name}`,
        text: `Nombre: ${name}\nEmpresa: ${company || "-"}\nEmail: ${email}\n\n${message}`,
      }),
    });

    if (!r.ok) {
      const err = await r.text();
      console.error("Resend error:", err);
      return res.status(502).json({ error: "No se pudo enviar el mensaje" });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Contact form error:", error);
    return res.status(500).json({ error: "Error interno" });
  }
}
