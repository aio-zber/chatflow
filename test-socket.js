// Test script to initialize socket
const { createServer } = require('http')
const { Server } = require('socket.io')

const httpServer = createServer()
const io = new Server(httpServer, {
  path: '/api/socket/io',
  addTrailingSlash: false,
  transports: ['polling'],
  cors: {
    origin: ['http://localhost:3000'],
    methods: ['GET', 'POST'],
    credentials: false,
  }
})

io.on('connection', (socket) => {
  console.log('User connected:', socket.id)
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id)
  })
})

httpServer.listen(3001, () => {
  console.log('Socket.IO test server running on port 3001')
})