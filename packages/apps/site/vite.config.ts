import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
export default defineConfig({envPrefix:['VITE_','SANDBLOCKS_SERVICE_','SANDBLOCKS_STABLE_SERVICE_','SANDBLOCKS_RUNTIME'],plugins:[tailwindcss(),react()],server:{host:'0.0.0.0',port:5174,strictPort:true,proxy:{'/trpc':{target:process.env.VITE_RUE_API_URL??'http://localhost:4097',changeOrigin:true}}}})
