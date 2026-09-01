import {z} from 'zod'
export const credentialLoginSchema=z.object({identifier:z.string().trim().min(3,'Enter your email address or username.').max(254),password:z.string().min(8,'Password must contain at least 8 characters.').max(256)})
export const mfaSchema=z.object({challengeToken:z.string().min(1).max(4096),code:z.string().regex(/^\d{6}$/,'Enter the 6-digit authentication code.')})
export type CredentialLoginInput=z.infer<typeof credentialLoginSchema>
