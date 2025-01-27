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
  groups: [],
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
    groupCount: 0,
    isBanned: false
  };
  db.users.push(user);
  saveDB();
  return user;
}

function findChannel(channelId) {
  return db.channels.find(c => c.channelId === channelId.toString());
}

function findGroup(groupId) {
  return db.groups.find(g => g.groupId === groupId.toString());
}

// Web interface routes
app.get('/', (req, res) => {
  const stats = {
    totalChannels: db.channels.length,
    totalGroups: db.groups.length,
    totalUsers: db.users.length,
    pendingApproval: db.channels.filter(c => !c.isApproved).length + db.groups.filter(g => !g.isApproved).length,
    categories: {
      '100-1000': db.channels.filter(c => c.category === '100-1000').length + db.groups.filter(g => g.category === '100-1000').length,
      '1000-5000': db.channels.filter(c => c.category === '1000-5000').length + db.groups.filter(g => g.category === '1000-5000').length,
      '5000+': db.channels.filter(c => c.category === '5000+').length + db.groups.filter(g => g.category === '5000+').length
    }
  };
  
  res.render('dashboard', { 
    channels: db.channels,
    groups: db.groups,
    users: db.users,
    stats
  });
});

app.post('/approve/:id', (req, res) => {
  const channel = findChannel(req.params.id);
  const group = findGroup(req.params.id);
  
  if (channel) {
    channel.isApproved = true;
    saveDB();
    bot.sendMessage(channel.channelId, 
      '✅ Canal aprovado!\n' +
      'As divulgações começarão no próximo ciclo.'
    );
  } else if (group) {
    group.isApproved = true;
    saveDB();
    bot.sendMessage(group.groupId, 
      '✅ Grupo aprovado!\n' +
      'As divulgações começarão no próximo ciclo.'
    );
  }
  res.redirect('/');
});

app.post('/disapprove/:id', (req, res) => {
  const channel = findChannel(req.params.id);
  const group = findGroup(req.params.id);
  
  if (channel) {
    channel.isApproved = false;
    saveDB();
    bot.sendMessage(channel.channelId, 
      '❌ Canal desaprovado.\n' +
      'Entre em contato com o administrador para mais informações.'
    );
  } else if (group) {
    group.isApproved = false;
    saveDB();
    bot.sendMessage(group.groupId, 
      '❌ Grupo desaprovado.\n' +
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

// Auto-register channel or group when bot is added as admin
bot.on('my_chat_member', async (chatMember) => {
  try {
    const chatId = chatMember.chat.id;
    const addedBy = chatMember.from.id;
    let user = findUser(addedBy) || createUser(addedBy);
    
    if (user.isBanned) {
      await bot.sendMessage(chatId, '❌ Usuário banido não pode registrar canais ou grupos.');
      return;
    }

    if (chatMember.new_chat_member.status === 'administrator') {
      const chatInfo = await bot.getChat(chatId);
      const memberCount = await bot.getChatMemberCount(chatId);

      if (memberCount < 1) {
        await bot.sendMessage(chatId, 
          '❌ Canal/Grupo não registrado: mínimo de 100 membros necessário.\n' +
          `Membros atuais: ${memberCount}`
        );
        return;
      }

      // Gerar link de convite
      const inviteLink = await bot.exportChatInviteLink(chatId);

      let category;
      if (memberCount < 1000) category = '100-1000';
      else if (memberCount < 5000) category = '1000-5000';
      else category = '5000+';

      const chatData = {
        id: chatId.toString(),
        title: chatInfo.title,
        memberCount,
        category,
        ownerId: addedBy.toString(),
        username: chatInfo.username,
        isApproved: false,
        inviteLink: inviteLink // Salvar o link de convite
      };

      if (chatMember.chat.type === 'channel') {
        if (user.channelCount >= 3) {
          await bot.sendMessage(chatId, '❌ Limite máximo de 3 canais atingido.');
          return;
        }

        const existingChannel = findChannel(chatId);
        if (existingChannel) {
          Object.assign(existingChannel, chatData);
        } else {
          db.channels.push(chatData);
          user.channelCount++;
        }
      } else if (chatMember.chat.type === 'group' || chatMember.chat.type === 'supergroup') {
        if (user.groupCount >= 3) {
          await bot.sendMessage(chatId, '❌ Limite máximo de 3 grupos atingido.');
          return;
        }

        const existingGroup = findGroup(chatId);
        if (existingGroup) {
          Object.assign(existingGroup, chatData);
        } else {
          db.groups.push(chatData);
          user.groupCount++;
        }
      }

      saveDB();

      await bot.sendMessage(chatId, 
        '✅ Canal/Grupo registrado automaticamente!\n\n' +
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
        '❌ Erro ao registrar canal/grupo automaticamente.\n' +
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
      '/registrar - Registrar um novo canal ou grupo\n' +
      '/minhascanais - Ver seus canais registrados\n' +
      '/meusgrupos - Ver seus grupos registrados\n' +
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
      return bot.sendMessage(chatId, '❌ Você está banido e não pode registrar canais ou grupos.');
    }

    if (user.channelCount >= 3 && user.groupCount >= 3) {
      return bot.sendMessage(chatId, '❌ Você já atingiu o limite máximo de 3 canais e 3 grupos.');
    }

    await bot.sendMessage(chatId, 
      '📝 Para registrar um canal ou grupo:\n\n' +
      '1. Adicione este bot como administrador do seu canal/grupo\n' +
      '2. O registro será feito automaticamente!\n\n' +
      'Requisitos:\n' +
      '• Mínimo de 100 membros\n' +
      '• Canal/Grupo deve ser público\n' +
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

bot.onText(/\/meusgrupos/, async (msg) => {
  try {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    console.log('My groups command received from:', userId);

    const userGroups = db.groups.filter(g => g.ownerId === userId.toString());

    if (userGroups.length === 0) {
      return bot.sendMessage(chatId, '📢 Você ainda não tem grupos registrados.');
    }

    const groupList = userGroups.map(group => 
      `📌 ${group.title}\n` +
      `👥 ${group.memberCount} membros\n` +
      `📊 Categoria: ${group.category}\n` +
      `🔗 Link: ${group.inviteLink}\n` +
      `✅ Aprovado: ${group.isApproved ? 'Sim' : 'Não'}\n`
    ).join('\n');

    await bot.sendMessage(chatId, 
      '📋 Seus grupos registrados:\n\n' + groupList
    );
  } catch (error) {
    console.error('Error in /meusgrupos command:', error);
    await bot.sendMessage(msg.chat.id, '❌ Ocorreu um erro ao listar seus grupos. Por favor, tente novamente.');
  }
});

// Schedule promotional posts every minute
schedule.scheduleJob('* * * * *', async () => {
  try {
    const categories = ['100-1000', '1000-5000', '5000+'];
    
    for (const category of categories) {
      const channels = db.channels.filter(c => c.category === category && c.isApproved);
      const groups = db.groups.filter(g => g.category === category && g.isApproved);

      if (channels.length > 0) {
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

          await bot.sendMessage(chunk[0].id, message, {
            reply_markup: {
              inline_keyboard: [buttons]
            }
          });
        }
      }

      if (groups.length > 0) {
        // Dividir os grupos em grupos de 20
        const chunkSize = 20;
        for (let i = 0; i < groups.length; i += chunkSize) {
          const chunk = groups.slice(i, i + chunkSize);

          // Criar botões para cada grupo
          const buttons = chunk.map(group => ({
            text: group.title,
            url: group.inviteLink
          }));

          // Enviar mensagem com botões
          const message = `📢 Lista de Grupos Parceiros (${category} membros)\n\n` +
            'Clique nos botões abaixo para entrar nos grupos:';

          await bot.sendMessage(chunk[0].id, message, {
            reply_markup: {
              inline_keyboard: [buttons]
            }
          });
        }
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