import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const EnvSchema = z.object({
  APP_SECRET: z.string().min(1),
  WEBHOOK_VERIFY_TOKEN: z.string().min(1),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production']).default('development'),
});

export interface Config {
  appSecret: string;
  webhookVerifyToken: string;
  whatsappAccessToken: string;
  whatsappPhoneNumberId: string;
  databaseUrl: string;
  port: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  nodeEnv: 'development' | 'production';
}

// Fail fast: EnvSchema.parse throws synchronously if a required var is missing,
// naming the missing key in the error message. Not caught here on purpose.
const env = EnvSchema.parse(process.env);

export const config: Config = {
  appSecret: env.APP_SECRET,
  webhookVerifyToken: env.WEBHOOK_VERIFY_TOKEN,
  whatsappAccessToken: env.WHATSAPP_ACCESS_TOKEN,
  whatsappPhoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
  databaseUrl: env.DATABASE_URL,
  port: env.PORT,
  logLevel: env.LOG_LEVEL,
  nodeEnv: env.NODE_ENV,
};
