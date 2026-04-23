# Encryption of PII at Rest

## Why it matters
Unencrypted PII in database columns is readable by anyone with DB access: DBAs, data analysts, support engineers, attackers who gain DB credentials. GDPR Article 32 requires "appropriate technical measures" — encryption at rest is the baseline.

## How to implement

```typescript
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex');  // 32-byte key

function encrypt(plaintext: string): { ciphertext: string; iv: string; tag: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv:         iv.toString('base64'),
    tag:        cipher.getAuthTag().toString('base64'),
  };
}

function decrypt(ciphertext: string, iv: string, tag: string): string {
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

// TypeORM column transformer
const encryptedColumn: ColumnOptions = {
  type: 'text',
  transformer: {
    to:   (value: string) => JSON.stringify(encrypt(value)),
    from: (value: string) => { const d = JSON.parse(value); return decrypt(d.ciphertext, d.iv, d.tag); },
  },
};
```

## Key implementation details
- Use AES-256-GCM (authenticated encryption) — GCM provides tamper detection
- Store IV alongside ciphertext — it is not secret but must be unique per encryption
- Never reuse IVs — always `crypto.randomBytes(12)` per encryption
- Store the encryption key in a secrets manager (AWS Secrets Manager, HashiCorp Vault), not in .env

## References
- https://gdpr.eu/article-32-security-of-processing/
- https://nodejs.org/api/crypto.html#cryptocreatecipherivalgorithm-key-iv-options
