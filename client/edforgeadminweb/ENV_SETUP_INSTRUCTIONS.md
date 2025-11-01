# Environment Variables Setup - Admin Web

## Step 1: Generate NEXTAUTH_SECRET

```bash
openssl rand -base64 32
```

Save this output - you'll need it in Step 2.

## Step 2: Create .env.local

Create a file named `.env.local` in this directory (`client/edforgeadminweb/.env.local`) with the following content:

```env
# Cognito Configuration (Control Plane User Pool)
NEXT_PUBLIC_CLIENT_ID=2e5s1h0alkmgqv8bro79uckgaa
NEXT_PUBLIC_WELL_KNOWN_ENDPOINT_URL=https://cognito-idp.us-east-1.amazonaws.com/us-east-1_lhufLThrp/.well-known/openid-configuration

# API Configuration
NEXT_PUBLIC_API_URL=https://edxqrry4u8.execute-api.us-east-1.amazonaws.com/

# NextAuth Configuration
NEXTAUTH_SECRET=<paste-your-generated-secret-from-step-1>
NEXTAUTH_URL=http://localhost:3000
```

Replace `<paste-your-generated-secret-from-step-1>` with the secret you generated in Step 1.

## Step 3: Configure Cognito Callback URLs

1. Go to AWS Console → Cognito → User Pools → `us-east-1_lhufLThrp`
2. Click **App integration** tab
3. Find the App Client with ID: `2e5s1h0alkmgqv8bro79uckgaa`
4. Edit **Hosted UI** settings
5. Add to **Allowed callback URLs**:
   ```
   http://localhost:3000/api/auth/callback/cognito
   ```
6. Add to **Allowed sign-out URLs**:
   ```
   http://localhost:3000
   ```

## Step 4: Test Locally

```bash
npm install
npm run dev
```

Navigate to http://localhost:3000 and test the authentication flow.

## Production Setup

When deploying to Vercel:

1. Add all environment variables from `.env.local` to Vercel project settings
2. Update `NEXTAUTH_URL` to your Vercel domain: `https://<your-project>.vercel.app`
3. Add production callback URLs to Cognito:
   - `https://<your-project>.vercel.app/api/auth/callback/cognito`
   - `https://<your-project>.vercel.app`
