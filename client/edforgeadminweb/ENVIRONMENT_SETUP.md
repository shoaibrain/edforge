# Environment Variables Setup Guide

This guide shows you exactly where to find each environment variable value for your NextJS Admin application.

## Quick Reference

All values come from your CDK deployment. You can find them in:
1. **CloudFormation Stack Outputs** (AWS Console)
2. **CDK Deploy Output** (terminal after `cdk deploy`)
3. **AWS Cognito Console**
4. **API Gateway Console**

---

## Step-by-Step: Finding Environment Variable Values

### 1. NEXT_PUBLIC_CLIENT_ID

**Where**: AWS Cognito User Pool App Client ID

**How to find**:

#### Option A: From CloudFormation Outputs
```bash
# In your terminal from the server directory:
cd /Users/shoaibrain/edforge/server
npx aws-cdk deploy --all --outputs-file cdk-outputs.json
```

Then look in `cdk-outputs.json` for the Control Plane stack outputs.

#### Option B: From AWS Console
1. Go to **AWS Console** → **Cognito** → **User Pools**
2. Find your Control Plane User Pool (usually named like `ControlPlaneStack-CognitoAuth-*`)
3. Click **App Integration** tab
4. Scroll to **App client list**
5. Copy the **Client ID**

#### Option C: From CDK Code (Control Plane)
The value is: `cognitoAuth.userClientId`

**Example value**:
```
NEXT_PUBLIC_CLIENT_ID=7kl8m9n0p1q2r3s4t5u6v7w8x9
```

---

### 2. NEXT_PUBLIC_ISSUER

**Where**: Cognito Token Endpoint

**Formula**:
```
https://cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}/oauth2/token
```

**How to find**:

#### Option A: From CloudFormation Outputs
Look for an output named something like `CognitoAuthTokenEndpoint` or similar in your Control Plane stack.

#### Option B: Construct Manually
1. Get your **Region** (e.g., `ap-northeast-2`)
2. Get your **User Pool ID** from Cognito Console:
   - AWS Console → Cognito → User Pools
   - Click on your Control Plane User Pool
   - Copy the **User Pool ID** (format: `{region}_{randomId}`, e.g., `ap-northeast-2_ABC123xyz`)

3. Construct the URL:
   ```
   https://cognito-idp.ap-northeast-2.amazonaws.com/ap-northeast-2_ABC123xyz/oauth2/token
   ```

**Example value**:
```
NEXT_PUBLIC_ISSUER=https://cognito-idp.ap-northeast-2.amazonaws.com/ap-northeast-2_znj5rT26i/oauth2/token
```

---

### 3. NEXT_PUBLIC_API_URL

**Where**: API Gateway Control Plane URL

**How to find**:

#### Option A: From CloudFormation Outputs
1. Go to **AWS Console** → **CloudFormation** → **Stacks**
2. Find your **ControlPlaneStack** or similar name
3. Click **Outputs** tab
4. Look for `regApiGatewayUrl` or `controlPlaneAPIGatewayUrl`
5. Copy the **Value**

#### Option B: From API Gateway Console
1. Go to **AWS Console** → **API Gateway**
2. Find your Control Plane API (usually named `controlplane-sbt-*`)
3. Click **Stages** → **prod** (or your stage name)
4. Copy the **Invoke URL**

#### Option C: From Terminal (after CDK deploy)
```bash
cd /Users/shoaibrain/edforge/server
aws cloudformation describe-stacks \
  --stack-name ControlPlaneStack \
  --query 'Stacks[0].Outputs[?OutputKey==`controlPlaneAPIGatewayUrl`].OutputValue' \
  --output text
```

**Example value**:
```
NEXT_PUBLIC_API_URL=https://abc123xyz.execute-api.ap-northeast-2.amazonaws.com/prod
```

**Important**: Remove any trailing slash!

---

### 4. NEXT_PUBLIC_WELL_KNOWN_ENDPOINT_URL

**Where**: Cognito OIDC Discovery Endpoint

**Formula**:
```
https://cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}/.well-known/openid-configuration
```

**How to find**:

#### Option A: Construct from User Pool ID
1. Get your **Region** (e.g., `ap-northeast-2`)
2. Get your **User Pool ID** (same as step 2 above)
3. Construct the URL:
   ```
   https://cognito-idp.ap-northeast-2.amazonaws.com/ap-northeast-2_ABC123xyz/.well-known/openid-configuration
   ```

#### Option B: Test the Endpoint
Once you have your User Pool ID, you can verify it works:
```bash
curl https://cognito-idp.ap-northeast-2.amazonaws.com/ap-northeast-2_ABC123xyz/.well-known/openid-configuration
```

This should return a JSON response with OIDC configuration.

**Example value**:
```
NEXT_PUBLIC_WELL_KNOWN_ENDPOINT_URL=https://cognito-idp.ap-northeast-2.amazonaws.com/ap-northeast-2_znj5rT26i/.well-known/openid-configuration
```

---

### 5. NEXTAUTH_SECRET

**Where**: Generate locally

**How to generate**:

#### On macOS/Linux:
```bash
openssl rand -base64 32
```

#### On Windows (PowerShell):
```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }) -as [byte[]])
```

#### Or use online generator:
Visit: https://generate-secret.vercel.app/32

**Example value**:
```
NEXTAUTH_SECRET=your_randomly_generated_secret_here_32_characters
```

**Important**: 
- Use a DIFFERENT secret for each environment (dev, staging, production)
- NEVER commit this to git
- NEVER share this secret

---

### 6. NEXTAUTH_URL

**Where**: Your application URL

**Values by environment**:

#### Local Development:
```
NEXTAUTH_URL=http://localhost:3000
```

#### Vercel Production:
```
NEXTAUTH_URL=https://your-app.vercel.app
```

#### Custom Domain:
```
NEXTAUTH_URL=https://admin.edforge.com
```

**Important**: This must match exactly where your app is hosted (no trailing slash)

---

### 7. COGNITO_CLIENT_SECRET (Optional)

**Where**: Only needed if using a confidential Cognito client

**How to check if you need this**:
1. Go to AWS Console → Cognito → User Pools → Your Pool
2. Click App Integration → App client list → Your client
3. Check if "Client secret" exists
   - If **No secret**, you don't need this variable
   - If **Has secret**, copy it

**Note**: The current setup uses a public client (no secret), so you likely DON'T need this.

---

## Complete Example

Here's what a complete `.env.local` file looks like with real values:

```bash
# Cognito Configuration
NEXT_PUBLIC_CLIENT_ID=7kl8m9n0p1q2r3s4t5u6v7w8x9
NEXT_PUBLIC_ISSUER=https://cognito-idp.ap-northeast-2.amazonaws.com/ap-northeast-2_znj5rT26i/oauth2/token
NEXT_PUBLIC_API_URL=https://abc123xyz.execute-api.ap-northeast-2.amazonaws.com/prod
NEXT_PUBLIC_WELL_KNOWN_ENDPOINT_URL=https://cognito-idp.ap-northeast-2.amazonaws.com/ap-northeast-2_znj5rT26i/.well-known/openid-configuration

# NextAuth Configuration
NEXTAUTH_SECRET=Xk7vP2mQ9wR4tY8zN3bV5gH1jL6fD0sA
NEXTAUTH_URL=http://localhost:3000

# Optional - only if using confidential client
# COGNITO_CLIENT_SECRET=your_secret_if_applicable
```

---

## Quick Setup Script

Run this script from the server directory to extract most values automatically:

```bash
#!/bin/bash
# Save as: get-env-values.sh

cd /Users/shoaibrain/edforge/server

echo "🔍 Fetching environment values from AWS..."
echo ""

# Get CloudFormation stack outputs
STACK_NAME="ControlPlaneStack"

# API URL
API_URL=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --query 'Stacks[0].Outputs[?contains(OutputKey, `ApiGatewayUrl`) || contains(OutputKey, `regApiGatewayUrl`)].OutputValue' \
  --output text 2>/dev/null)

echo "✅ NEXT_PUBLIC_API_URL=$API_URL"
echo ""

# Admin Site URL
ADMIN_URL=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --query 'Stacks[0].Outputs[?OutputKey==`adminSiteUrl`].OutputValue' \
  --output text 2>/dev/null)

echo "📝 Admin Site URL: $ADMIN_URL"
echo ""

# List all Cognito User Pools to find the control plane pool
echo "🔑 Cognito User Pools:"
aws cognito-idp list-user-pools --max-results 10 \
  --query 'UserPools[*].[Name,Id]' \
  --output table

echo ""
echo "👆 Find your Control Plane User Pool and use its ID to construct:"
echo "   NEXT_PUBLIC_CLIENT_ID - Get from Cognito Console → User Pool → App Integration → App client list"
echo "   NEXT_PUBLIC_ISSUER - https://cognito-idp.REGION.amazonaws.com/USER_POOL_ID/oauth2/token"
echo "   NEXT_PUBLIC_WELL_KNOWN_ENDPOINT_URL - https://cognito-idp.REGION.amazonaws.com/USER_POOL_ID/.well-known/openid-configuration"
echo ""
echo "🔐 Generate NEXTAUTH_SECRET:"
echo "   openssl rand -base64 32"
```

Make it executable and run:
```bash
chmod +x get-env-values.sh
./get-env-values.sh
```

---

## Verification

After setting up your `.env.local`, verify the values are correct:

### 1. Test OIDC Discovery Endpoint:
```bash
curl $NEXT_PUBLIC_WELL_KNOWN_ENDPOINT_URL | jq
```

Should return JSON with `issuer`, `authorization_endpoint`, etc.

### 2. Test API Gateway:
```bash
curl $NEXT_PUBLIC_API_URL/health
# or
curl $NEXT_PUBLIC_API_URL/tenants
```

### 3. Start the dev server:
```bash
cd /Users/shoaibrain/edforge/client/edforgeadminweb
npm run dev
```

Visit http://localhost:3000 - you should be redirected to Cognito login.

---

## Troubleshooting

### Issue: "Invalid client_id"
- **Solution**: Double-check `NEXT_PUBLIC_CLIENT_ID` in Cognito Console

### Issue: "Redirect URI mismatch"
- **Solution**: Add your `NEXTAUTH_URL` to Cognito App Client callback URLs:
  - AWS Console → Cognito → User Pool → App Integration → App client
  - Add to **Allowed callback URLs**: `http://localhost:3000/api/auth/callback/cognito`
  - Add to **Allowed sign-out URLs**: `http://localhost:3000`

### Issue: "Network error" or "API calls failing"
- **Solution**: Verify `NEXT_PUBLIC_API_URL` is correct and accessible

### Issue: "Session not persisting"
- **Solution**: Ensure `NEXTAUTH_SECRET` is set and `NEXTAUTH_URL` matches your current URL

---

## Security Reminders

- ✅ **DO**: Keep `.env.local` in `.gitignore`
- ✅ **DO**: Use different secrets for each environment
- ✅ **DO**: Store production secrets in Vercel Environment Variables
- ❌ **DON'T**: Commit `.env.local` to git
- ❌ **DON'T**: Share secrets in chat or documentation
- ❌ **DON'T**: Use the same `NEXTAUTH_SECRET` across environments

---

## Next Steps

1. Create your `.env.local` file with the values you found
2. Run `npm run dev` to test locally
3. Configure the same variables in Vercel for deployment
4. Update Cognito callback URLs to include your Vercel domain

Need help? Check the main [README.md](./README.md) or [DEPLOYMENT.md](./DEPLOYMENT.md) for more details.

