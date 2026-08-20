import './styles/app.css'
import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'
import {QueryClientProvider} from '@tanstack/react-query'
import {RouterProvider} from '@tanstack/react-router'
import {createRueQueryClient} from '@multiterm/rue-trpc/client'
import {ThemeProvider} from '@multiterm/rue-ui'
import {router} from './router'
const queryClient=createRueQueryClient()
createRoot(document.getElementById('root')!).render(<StrictMode><ThemeProvider><QueryClientProvider client={queryClient}><RouterProvider router={router}/></QueryClientProvider></ThemeProvider></StrictMode>)
