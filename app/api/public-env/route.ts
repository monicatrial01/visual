export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || null
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || null

  // Para segurança e simplicidade, não retornamos a key.
  // Retornamos apenas indicadores booleanos e o host da URL.
  let urlHost: string | null = null
  try {
    if (url) urlHost = new URL(url).host
  } catch {}

  return Response.json({
    hasUrl: !!url,
    hasAnon: !!anon,
    urlHost,
  })
}
