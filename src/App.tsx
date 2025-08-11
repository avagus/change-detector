@@ .. @@
 // Backend base URL (set VITE_BACKEND_URL in your env for production)
-const BACKEND =  import.meta.env.VITE_BACKEND_URL;
+const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8080';