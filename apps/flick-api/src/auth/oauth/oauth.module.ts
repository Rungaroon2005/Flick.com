import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { IdentityProvider } from '@prisma/client';
import { UsersModule } from '../../users/users.module';
import {
  OAUTH_PROVIDER_REGISTRY,
  type OAuthProviderRegistry,
} from './oauth-provider.port';
import { GoogleProviderAdapter } from './adapters/google-provider.adapter';
import { AppleProviderAdapter } from './adapters/apple-provider.adapter';
import { FakeOAuthProviderAdapter } from './adapters/fake-provider.adapter';
import { OAuthNonceService } from './oauth-nonce.service';
import { IdentityResolver } from './identity-resolver';
import { OAuthController } from './oauth.controller';

// Exported rather than inlined so it can be unit-tested with a stubbed
// ConfigService, the same way createOtpDeliveryPort is (otp.module.ts:15).
export function createOAuthProviderRegistry(
  config: ConfigService,
): OAuthProviderRegistry {
  const enabled = String(config.get<string>('OAUTH_PROVIDERS', ''))
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);

  const registry: OAuthProviderRegistry = new Map();
  // validateEnv has already rejected unknown names and missing credentials, so
  // anything reaching here is configured.
  if (enabled.includes('google')) {
    registry.set(IdentityProvider.GOOGLE, new GoogleProviderAdapter(config));
  }
  if (enabled.includes('apple')) {
    registry.set(IdentityProvider.APPLE, new AppleProviderAdapter(config));
  }
  if (enabled.includes('fake')) {
    // Stands in for BOTH providers so e2e can exercise either path.
    registry.set(
      IdentityProvider.GOOGLE,
      new FakeOAuthProviderAdapter(IdentityProvider.GOOGLE),
    );
    registry.set(
      IdentityProvider.APPLE,
      new FakeOAuthProviderAdapter(IdentityProvider.APPLE),
    );
  }
  return registry;
}

@Module({
  imports: [ConfigModule, UsersModule],
  controllers: [OAuthController],
  providers: [
    OAuthNonceService,
    IdentityResolver,
    {
      provide: OAUTH_PROVIDER_REGISTRY,
      inject: [ConfigService],
      useFactory: createOAuthProviderRegistry,
    },
  ],
  exports: [OAuthNonceService, IdentityResolver, OAUTH_PROVIDER_REGISTRY],
})
export class OAuthModule {}
