const TelegramBot = require('node-telegram-bot-api');
const schedule = require('node-schedule');
const express = require('express');
const fs = require('fs');
require('dotenv').config();

// Initialize Express
const app = express();
app.set('view engine', 'ejs');
app.set('views', './src/views');
app.use(express.urlencoded({ extended: true }));

// Initialize JSON storage
const DB_FILE = './database.json';
let db = {
  channels: [],
  users: []
};

// Load database from file
try {
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  }
} catch (error) {
  console.error('Error loading database:', error);
}

// Save database to file
function saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (error) {
    console.error('Error saving database:', error);
  }
}

// Initialize bot
const bot = new TelegramBot(process.env.BOT_TOKEN, { 
  polling: true,
  filepath: false
});

// Error handlers
bot.on('polling_error', (error) => {
  console.error('Bot polling error:', error);
});

bot.on('error', (error) => {
  console.error('Bot general error:', error);
});

// Helper functions
function findUser(userId) {
  return db.users.find(u => u.userId === userId.toString());
}

function createUser(userId) {
  const user = {
    userId: userId.toString(),
    channelCount: 0,
    isBanned: false
  };
  db.users.push(user);
  saveDB();
  return user;
}

function findChannel(channelId) {
  return db.channels.find(c => c.channelId === channelId.toString());
}

// Web interface routes
app.get('/', (req, res) => {
  const stats = {
    totalChannels: db.channels.length,
    totalUsers: db.users.length,
    pendingApproval: db.channels.filter(c => !c.isApproved).length,
    categories: {
      '100-1000': db.channels.filter(c => c.category === '100-1000').length,
      '1000-5000': db.channels.filter(c => c.category === '1000-5000').length,
      '5000+': db.channels.filter(c => c.category === '5000+').length
    }
  };
  
  res.render('dashboard', { 
    channels: db.channels,
    users: db.users,
    stats
  });
});

app.post('/approve/:channelId', (req, res) => {
  const channel = findChannel(req.params.channelId);
  if (channel) {
    channel.isApproved = true;
    saveDB();
    bot.sendMessage(channel.channelId, 
      '✅ Canal aprovado!\n' +
      'As divulgações começarão no próximo ciclo.'
    );
  }
  res.redirect('/');
});

app.post('/disapprove/:channelId', (req, res) => {
  const channel = findChannel(req.params.channelId);
  if (channel) {
    channel.isApproved = false;
    saveDB();
    bot.sendMessage(channel.channelId, 
      '❌ Canal desaprovado.\n' +
      'Entre em contato com o administrador para mais informações.'
    );
  }
  res.redirect('/');
});

app.post('/ban/:userId', (req, res) => {
  const user = findUser(req.params.userId);
  if (user) {
    user.isBanned = true;
    saveDB();
  }
  res.redirect('/');
});

app.post('/unban/:userId', (req, res) => {
  const user = findUser(req.params.userId);
  if (user) {
    user.isBanned = false;
    saveDB();
  }
  res.redirect('/');
});

// Auto-register channel when bot is added as admin
bot.on('my_chat_member', async (chatMember) => {
  try {
    if (chatMember.chat.type === 'channel' && 
        chatMember.new_chat_member.status === 'administrator') {
      
      const channelId = chatMember.chat.id;
      const chatInfo = await bot.getChat(channelId);
      const memberCount = await bot.getChatMemberCount(channelId);
      const addedBy = chatMember.from.id;
      let user = findUser(addedBy) || createUser(addedBy);
      
      if (user.isBanned) {
        await bot.sendMessage(channelId, '❌ Usuário banido não pode registrar canais.');
        return;
      }

      if (user.channelCount >= 3) {
        await bot.sendMessage(channelId, '❌ Limite máximo de 3 canais atingido.');
        return;
      }

      if (memberCount < 1) {
        await bot.sendMessage(channelId, 
          '❌ Canal não registrado: mínimo de 100 membros necessário.\n' +
          `Membros atuais: ${memberCount}`
        );
        return;
      }

      // Gerar link de convite
      const inviteLink = await bot.exportChatInviteLink(channelId);

      let category;
      if (memberCount < 1000) category = '100-1000';
      else if (memberCount < 5000) category = '1000-5000';
      else category = '5000+';

      const channel = {
        channelId: channelId.toString(),
        title: chatInfo.title,
        memberCount,
        category,
        ownerId: addedBy.toString(),
        username: chatInfo.username,
        isApproved: false,
        inviteLink: inviteLink // Salvar o link de convite
      };

      const existingChannel = findChannel(channelId);
      if (existingChannel) {
        Object.assign(existingChannel, channel);
      } else {
        db.channels.push(channel);
        user.channelCount++;
      }

      saveDB();

      await bot.sendMessage(channelId, 
        '✅ Canal registrado automaticamente!\n\n' +
        `📌 Título: ${chatInfo.title}\n` +
        `👥 Membros: ${memberCount}\n` +
        `📊 Categoria: ${category}\n` +
        `🔗 Link de convite: ${inviteLink}\n\n` +
        'ℹ️ Aguardando aprovação para início das divulgações.'
      );
    }
  } catch (error) {
    console.error('Error in auto-registration:', error);
    try {
      await bot.sendMessage(chatMember.chat.id, 
        '❌ Erro ao registrar canal automaticamente.\n' +
        'Por favor, verifique se o bot tem todas as permissões necessárias.'
      );
    } catch (sendError) {
      console.error('Error sending error message:', sendError);
    }
  }
});

// Bot commands
bot.onText(/\/start/, async (msg) => {
  try {
    const chatId = msg.chat.id;
    console.log('Start command received from:', chatId);
    
    await bot.sendMessage(chatId, 
      'Bem-vindo ao Bot de Divulgação! 📢\n\n' +
      'Comandos disponíveis:\n' +
      '/registrar - Registrar um novo canal\n' +
      '/minhascanais - Ver seus canais registrados\n' +
      '/listas - Ver listas de divulgação\n' +
      '/ajuda - Ver instruções de uso'
    );
  } catch (error) {
    console.error('Error in /start command:', error);
  }
});

bot.onText(/\/registrar/, async (msg) => {
  try {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    console.log('Register command received from:', userId);
    
    let user = findUser(userId) || createUser(userId);

    if (user.isBanned) {
      return bot.sendMessage(chatId, '❌ Você está banido e não pode registrar canais.');
    }

    if (user.channelCount >= 3) {
      return bot.sendMessage(chatId, '❌ Você já atingiu o limite máximo de 3 canais.');
    }

    await bot.sendMessage(chatId, 
      '📝 Para registrar um canal:\n\n' +
      '1. Adicione este bot como administrador do seu canal\n' +
      '2. O registro será feito automaticamente!\n\n' +
      'Requisitos:\n' +
      '• Mínimo de 100 membros\n' +
      '• Canal deve ser público\n' +
      '• Bot precisa ser administrador'
    );
  } catch (error) {
    console.error('Error in /registrar command:', error);
    await bot.sendMessage(msg.chat.id, '❌ Ocorreu um erro ao processar seu comando. Por favor, tente novamente.');
  }
});

bot.onText(/\/minhascanais/, async (msg) => {
  try {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    console.log('My channels command received from:', userId);

    const userChannels = db.channels.filter(c => c.ownerId === userId.toString());

    if (userChannels.length === 0) {
      return bot.sendMessage(chatId, '📢 Você ainda não tem canais registrados.');
    }

    const channelList = userChannels.map(channel => 
      `📌 ${channel.title}\n` +
      `👥 ${channel.memberCount} membros\n` +
      `📊 Categoria: ${channel.category}\n` +
      `🔗 Link: ${channel.inviteLink}\n` +
      `✅ Aprovado: ${channel.isApproved ? 'Sim' : 'Não'}\n`
    ).join('\n');

    await bot.sendMessage(chatId, 
      '📋 Seus canais registrados:\n\n' + channelList
    );
  } catch (error) {
    console.error('Error in /minhascanais command:', error);
    await bot.sendMessage(msg.chat.id, '❌ Ocorreu um erro ao listar seus canais. Por favor, tente novamente.');
  }
});

// Schedule promotional posts every minute
schedule.scheduleJob('* * * * *', async () => {
  try {
    const categories = ['100-1000', '1000-5000', '5000+'];
    
    for (const category of categories) {
      const channels = db.channels.filter(c => c.category === category && c.isApproved);
      if (channels.length === 0) continue;

      // Dividir os canais em grupos de 20
      const chunkSize = 20;
      for (let i = 0; i < channels.length; i += chunkSize) {
        const chunk = channels.slice(i, i + chunkSize);

        // Criar botões para cada canal
        const buttons = chunk.map(channel => ({
          text: channel.title,
          url: channel.inviteLink
        }));

        // Enviar mensagem com botões
        const message = `📢 Lista de Canais Parceiros (${category} membros)\n\n` +
          'Clique nos botões abaixo para entrar nos canais:';

        await bot.sendMessage(chunk[0].channelId, message, {
          reply_markup: {
            inline_keyboard: [buttons]
          }
        });
      }
    }
  } catch (error) {
    console.error('Error in promotional post schedule:', error);
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Interface de gerenciamento rodando em http://localhost:${PORT}`);
  console.log('🤖 Bot iniciado com sucesso!');
});