import { Hono } from 'hono'

const app = new Hono()

app.get('/', (c) => {
  return c.json({ success: true, message: 'Distiller API is alive' })
})

export default app
