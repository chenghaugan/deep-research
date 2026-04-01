FROM node:18-alpine

WORKDIR /app

COPY package.json ./
RUN npm install

COPY proxy.js ./

EXPOSE 3021

CMD ["npm", "start"]