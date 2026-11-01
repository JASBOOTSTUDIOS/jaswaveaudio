import { generateKeyPair, exportJWK, SignJWT, type JWK } from 'jose';

/** Emisor de JWT de prueba con clave Ed25519 y JWKS equivalente al de Supabase. */
export async function crearEmisorPrueba() {
  const { publicKey, privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
  const jwk = await exportJWK(publicKey);
  const kid = 'prueba-1';
  const claves: JWK[] = [{ ...jwk, kid, alg: 'EdDSA', use: 'sig' }];
  return {
    jwks: { keys: claves },
    async emitir(claims: { sub: string; email: string; roles?: string[]; exp?: number; issuer?: string }) {
      const builder = new SignJWT({ email: claims.email, roles: claims.roles ?? [] })
        .setProtectedHeader({ alg: 'EdDSA', kid })
        .setSubject(claims.sub)
        .setAudience('authenticated')
        .setIssuedAt();
      if (claims.issuer) builder.setIssuer(claims.issuer);
      builder.setExpirationTime(claims.exp ?? Math.floor(Date.now() / 1000) + 3600);
      return builder.sign(privateKey);
    },
  };
}
