# MS-TASK-WORKER CONTEINERIZADO

Este é o microsserviço de backend assíncrono para a plataforma Ana. Ele se conecta à fila RabbitMQ e executa as transcrições usando a LLM sem os limites de tempo (timeouts) impostos por ambientes serverless como a Vercel.

## Pré-requisitos na VPS
- Docker
- Docker Compose

## Como Iniciar (Deploy VPS)

## Como Iniciar (Deploy VPS Super Seguro)

A seu pedido, este repositório possui a segurança hard-coded: não é exigido que você solte as chaves API (`.env`) descriptografadas no disco do servidor. As chaves já estão "cozidas" dentro deste pacote compactado `ana-worker.tar`.

1. Transfira OS ÚNICOS 2 arquivos a seguir para uma pasta vazia na sua VPS (via SCP ou FTP do Windows):
   - `ana-worker.tar`
   - `docker-compose.yml`

2. Carregue a imagem compactada e selada para o cache local do Docker da VPS:
   ```bash
   docker load -i ana-worker.tar
   ```
3. Suba o container rodando no background:
   ```bash
   docker-compose up -d
   ```

## Escalando Vertical/Horizontalmente

Se a sua fila de transcrição no RabbitMQ começar a ficar muito grande, ou se tiver muitos usuários enviando material de uma vez, você pode escalar instâncias extras (desde que o `CONCURRENCY` no seu env esteja bem calibrado ou se quiser isolamento total):

```bash
docker-compose up -d --scale worker=3
```
*(Isso subirá 3 conteiners escutando a mesma fila RabbitMQ e dividindo o trabalho de mensagens)*

## Logs e Monitoramento
Para ver em tempo real como o processo da LLM está ocorrendo na VPS (os logs dos workers):
```bash
docker-compose logs -f worker
```

# Passo a passo para enviar a imagem para a vps

1. Crie a imagem localmente:
```bash
docker build -t ana-worker:latest .
```

2. Salve a imagem:
```bash
docker save -o ana-worker.tar ana-worker:latest
```

3. Transfira o arquivo `ana-worker.tar` para a VPS (via SCP ou FTP do Windows):
comando urilizado: 
```bash
scp -o ServerAliveInterval=15 -o ServerAliveCountMax=60 -o TCPKeepAlive=yes ./ana-worker.tar root@191.252.196.119:/var/www/app/
```

4. Carregue a imagem na VPS:
```bash
docker load -i ana-worker.tar
```

5. Suba o container:
```bash
docker-compose up -d
```