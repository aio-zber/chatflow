const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Starting database seeding...')

  // Create test users
  const hashedPassword = await bcrypt.hash('password123', 10)

  const user1 = await prisma.user.upsert({
    where: { email: 'alice@example.com' },
    update: {},
    create: {
      id: 'cmeb6bzsv0001kuas0gvhtyvx', // Use the ID from the logs
      email: 'alice@example.com',
      username: 'alice',
      name: 'Alice Johnson',
      password: hashedPassword,
      avatar: null,
      bio: 'Test user for call functionality',
      isOnline: false,
    },
  })

  const user2 = await prisma.user.upsert({
    where: { email: 'bob@example.com' },
    update: {},
    create: {
      id: 'cmeb6bc860000kuasz9qh1jxw', // Use the ID from the logs
      email: 'bob@example.com',
      username: 'bob',
      name: 'Bob Smith',
      password: hashedPassword,
      avatar: null,
      bio: 'Test user for call functionality',
      isOnline: false,
    },
  })

  // Create a conversation between the users
  const conversation = await prisma.conversation.create({
    data: {
      name: null, // Direct message (no name)
      isGroup: false,
      participants: {
        create: [
          {
            userId: user1.id,
            role: 'member',
          },
          {
            userId: user2.id,
            role: 'member',
          },
        ],
      },
    },
  })

  console.log('✅ Database seeded successfully!')
  console.log(`👤 Created users: ${user1.name} (${user1.id}) and ${user2.name} (${user2.id})`)
  console.log(`💬 Created conversation: ${conversation.id}`)
  console.log('\n🔧 You can now test calls between these users')
  console.log('📧 Login credentials:')
  console.log('   - alice@example.com / password123')
  console.log('   - bob@example.com / password123')
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })