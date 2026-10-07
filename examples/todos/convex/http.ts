import { httpRouter } from 'convex/server';
import { platforms } from './ports';

const http = httpRouter();
platforms.registerRoutes(http);
export default http;
