"use client";

import { signIn, getSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, Loader2 } from "lucide-react";

export default function SignInPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    // Check if user is already authenticated
    const checkAuth = async () => {
      const session = await getSession();
      if (session) {
        router.push("/dashboard");
      }
    };
    checkAuth();
  }, [router]);

  const handleSignIn = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await signIn("cognito", {
        redirect: false,
        callbackUrl: "/dashboard",
      });

      if (result?.error) {
        setError("Authentication failed. Please try again.");
      } else if (result?.ok) {
        router.push("/dashboard");
      }
    } catch (err) {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-lg">E</span>
          </div>
          <CardTitle className="text-2xl font-bold">Welcome to EdForge</CardTitle>
          <CardDescription>
            Sign in to access your educational management system
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg border border-error bg-error/10 text-error">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          <Button
            onClick={handleSignIn}
            disabled={isLoading}
            className="w-full"
            size="lg"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Signing in...
              </>
            ) : (
              "Sign in with Cognito"
            )}
          </Button>

          <div className="text-center text-sm text-muted-foreground">
            <p>
              Secure authentication powered by AWS Cognito
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
