FROM oven/bun:1.3.13

WORKDIR /usr/src/app

#COPY PART
COPY ./package.json ./package.json
COPY ./packages/db ./packages/db  
COPY ./bun.lock ./bun.lock 
COPY ./turbo.json ./turbo.json 
COPY ./apps/websocket ./apps/websocket 

RUN bun install

RUN bun run generate:db

EXPOSE 8081

CMD ["bun", "run", "start:ws"]