# Bot de Divulgação do Telegram

Bot para gerenciamento automático de divulgação entre canais do Telegram.

## Configuração no Termux

1. Instale o Termux pela Play Store
2. Execute os seguintes comandos:

```bash
pkg update && pkg upgrade
pkg install nodejs
pkg install git

# Clone o repositório ou copie os arquivos
git clone <seu-repositorio>
cd <pasta-do-projeto>

# Instale as dependências
npm install

# Configure o token do bot
# Edite o arquivo .env e adicione seu BOT_TOKEN

# Inicie o bot
npm start
```

## Funcionalidades

- Cadastro automático de canais
- Categorização por número de membros
- Divulgação automática a cada 4 horas
- Sistema de aprovação de canais
- Limite de 3 canais por usuário
- Fixação automática das listas de divulgação

## Comandos

- `/start` - Iniciar o bot
- `/registrar` - Registrar um novo canal
- `/minhascanais` - Ver canais registrados
- `/listas` - Ver listas de divulgação
- `/ajuda` - Ver instruções de uso

## Requisitos para Canais

- Mínimo de 100 membros
- Bot deve ser administrador
- Canal deve ser público (ter username)

## Categorias

- 100-1000 membros
- 1000-5000 membros
- 5000+ membros