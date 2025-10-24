# Deployment Guide - EdForge Admin Web

Complete guide for deploying the NextJS Admin application to Vercel.

## Pre-Deployment Checklist

- [ ] All environment variables documented
- [ ] AWS Cognito User Pool configured
- [ ] Backend API Gateway deployed and accessible
- [ ] Code pushed to GitHub repository
- [ ] `.env.local` configured and tested locally

## Vercel Deployment Steps

### Step 1: Prepare Your Repository

```bash
cd /Users/shoaibrain/edforge
git add client/edforgeadminweb
git commit -m "Add NextJS admin application"
git push origin main
```

### Step 2: Create Vercel Project

1. Go to [https://vercel.com](https://vercel.com)
2. Click "Add New" → "Project"
3. Select your GitHub repository
4. Configure project:
   - **Framework Preset**: Next.js
   - **Root Directory**: `client/edforgeadminweb`
   - **Build Command**: `npm run build` (default)
   - **Output Directory**: `.next` (default)
   - **Install Command**: `npm install` (default)

### Step 3: Configure Environment Variables

Add these in Vercel Project Settings → Environment Variables:

#### Production Environment

```
NEXT_PUBLIC_CLIENT_ID=your_cognito_client_id
NEXT_PUBLIC_ISSUER=https://cognito-idp.ap-northeast-2.amazonaws.com/ap-northeast-2_YourPool/oauth2/token
NEXT_PUBLIC_API_URL=https://your-api.execute-api.ap-northeast-2.amazonaws.com/prod
NEXT_PUBLIC_WELL_KNOWN_ENDPOINT_URL=https://cognito-idp.ap-northeast-2.amazonaws.com/ap-northeast-2_YourPool/.well-known/openid-configuration
NEXTAUTH_SECRET=generate_with_openssl_rand_base64_32
NEXTAUTH_URL=https://your-project.vercel.app
```

> **Important**: `NEXTAUTH_URL` must match your Vercel deployment URL

#### Preview Environment (Optional)

If you want separate settings for preview deployments:
- Add the same variables with "Preview" scope
- Update `NEXTAUTH_URL` to use preview domains

### Step 4: Deploy

Click "Deploy" - Vercel will:
1. Clone your repository
2. Install dependencies
3. Build the Next.js application
4. Deploy to global edge network

### Step 5: Update AWS Cognito

After first deployment, configure Cognito with your Vercel URLs:

1. **AWS Console** → **Cognito** → **User Pools** → Select your pool
2. **App Integration** → **App client list** → Select your app client
3. **Hosted UI** settings:

**Allowed callback URLs** (add these):
```
https://your-project.vercel.app/api/auth/callback/cognito
https://your-project-*.vercel.app/api/auth/callback/cognito
http://localhost:3000/api/auth/callback/cognito
```

**Allowed sign-out URLs** (add these):
```
https://your-project.vercel.app
https://your-project-*.vercel.app
http://localhost:3000
```

**Allowed OAuth Scopes**:
- ✅ openid
- ✅ profile
- ✅ email
- ✅ Custom scopes: `tenant/tenant_read`, `tenant/tenant_write`, `user/user_read`, `user/user_write`

### Step 6: Verify Deployment

1. **Visit your deployment**:
   ```
   https://your-project.vercel.app
   ```

2. **Test authentication**:
   - Click "Sign In with Cognito"
   - Complete Cognito login
   - Verify redirect back to app
   - Check that user info appears in header

3. **Test API integration**:
   - Navigate to Tenants page
   - Verify tenants load correctly
   - Test create/delete operations

4. **Check browser console**:
   - No authentication errors
   - API calls returning 200/201 status codes

## Continuous Deployment

Once configured, Vercel automatically deploys:

- **Production**: Commits to `main` branch → `https://your-project.vercel.app`
- **Preview**: Pull requests → `https://your-project-git-branch.vercel.app`
- **Development**: Other branches (optional)

### Branch Configuration

In Vercel Project Settings → Git:
- **Production Branch**: `main`
- **Automatic deployments for Production**: ✅ Enabled
- **Automatic deployments for Preview**: ✅ Enabled

## Custom Domain (Optional)

### Add Custom Domain

1. Vercel Dashboard → Your Project → Settings → Domains
2. Add your domain (e.g., `admin.edforge.com`)
3. Configure DNS:

**For apex domain** (edforge.com):
```
A     @    76.76.19.19
AAAA  @    2606:4700:4700::1111
```

**For subdomain** (admin.edforge.com):
```
CNAME admin  cname.vercel-dns.com
```

4. Update environment variables:
```
NEXTAUTH_URL=https://admin.edforge.com
```

5. Update Cognito callback URLs:
```
https://admin.edforge.com/api/auth/callback/cognito
https://admin.edforge.com
```

## Monitoring & Debugging

### Vercel Dashboard

- **Deployments**: View build logs and deployment history
- **Analytics**: Track performance and usage
- **Logs**: Real-time function logs
- **Speed Insights**: Core Web Vitals metrics

### Debugging Failed Deployments

1. **Check build logs** in Vercel dashboard
2. **Common issues**:
   - Missing environment variables
   - TypeScript errors
   - Dependencies not installed
   - Build timeout (increase in settings)

3. **Test locally first**:
   ```bash
   npm run build
   npm start
   ```

### Runtime Monitoring

View runtime errors:
1. Vercel Dashboard → Your Project → Functions
2. Select a function to view logs
3. Filter by error status codes

## Performance Optimization

### Edge Configuration

Vercel automatically:
- Deploys to global edge network
- Caches static assets
- Optimizes images
- Compresses responses

### Additional Optimizations

1. **Enable Image Optimization**:
   - Already configured in Next.js
   - Uses Vercel's Image Optimization

2. **Configure Caching**:
   ```typescript
   // In next.config.ts
   export default {
     headers: async () => [
       {
         source: '/api/:path*',
         headers: [
           { key: 'Cache-Control', value: 'no-store' }
         ]
       }
     ]
   }
   ```

3. **Monitor Core Web Vitals**:
   - Enable Speed Insights in Vercel
   - Track LCP, FID, CLS metrics

## Security Best Practices

### Environment Variables

✅ **DO**:
- Use Vercel's encrypted environment variables
- Generate unique `NEXTAUTH_SECRET` for each environment
- Keep secrets out of git

❌ **DON'T**:
- Commit `.env.local` to git
- Share production secrets
- Use same secrets across environments

### HTTPS & Headers

Vercel automatically provides:
- SSL/TLS certificates
- Security headers
- DDoS protection

### Rate Limiting

Consider adding rate limiting for API routes:
```typescript
// In API routes
import { Ratelimit } from "@upstash/ratelimit"

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, "10 s"),
})
```

## Rollback Strategy

### Quick Rollback

1. Vercel Dashboard → Deployments
2. Find last working deployment
3. Click "..." → "Promote to Production"

### Git-based Rollback

```bash
git revert HEAD
git push origin main
```

## Cost Optimization

### Vercel Pricing Tiers

- **Hobby** (Free):
  - Perfect for development/testing
  - 100GB bandwidth
  - Serverless function limits

- **Pro** ($20/month per user):
  - Production workloads
  - 1TB bandwidth
  - Advanced analytics
  - Team collaboration

### Monitoring Usage

- Vercel Dashboard → Usage
- Track:
  - Bandwidth consumption
  - Function executions
  - Build minutes
  - Team seats

## Troubleshooting Common Issues

### Issue: "Unauthorized" after deployment

**Solution**:
1. Verify Cognito callback URLs include Vercel domain
2. Check `NEXTAUTH_URL` matches deployment URL
3. Ensure `NEXTAUTH_SECRET` is set

### Issue: API calls failing

**Solution**:
1. Check `NEXT_PUBLIC_API_URL` is correct
2. Verify CORS settings on API Gateway
3. Check API Gateway authentication requirements

### Issue: Build failing

**Solution**:
1. Run `npm run build` locally first
2. Check TypeScript errors
3. Verify all dependencies in `package.json`
4. Check build logs in Vercel dashboard

### Issue: Slow cold starts

**Solution**:
1. Upgrade to Vercel Pro for faster cold starts
2. Optimize bundle size
3. Use dynamic imports for large dependencies

## Support & Resources

- **Vercel Documentation**: https://vercel.com/docs
- **Next.js Documentation**: https://nextjs.org/docs
- **NextAuth.js Documentation**: https://next-auth.js.org
- **Vercel Discord**: https://vercel.com/discord

## Deployment Checklist

Before going to production:

- [ ] All environment variables configured
- [ ] Cognito callback URLs updated
- [ ] Custom domain configured (if applicable)
- [ ] SSL certificate verified
- [ ] Authentication flow tested
- [ ] API integration verified
- [ ] Error monitoring configured
- [ ] Analytics enabled
- [ ] Team access configured
- [ ] Backup/rollback strategy documented
- [ ] Security headers verified
- [ ] Performance metrics baseline captured

## Next Steps After Deployment

1. **Monitor Performance**:
   - Enable Vercel Analytics
   - Set up alerts for errors
   - Track Core Web Vitals

2. **Configure CI/CD**:
   - Add automated tests
   - Enable preview deployments for PRs
   - Set up staging environment

3. **Documentation**:
   - Document deployment process
   - Create runbook for common issues
   - Share credentials securely with team

4. **Maintenance**:
   - Schedule regular dependency updates
   - Monitor security advisories
   - Review and optimize performance

---

**Last Updated**: October 2025
**Deployment Platform**: Vercel
**Framework**: Next.js 15

