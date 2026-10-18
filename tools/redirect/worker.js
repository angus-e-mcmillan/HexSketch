// Forwards the beta's old address and www.hexsketch.com to HexSketch,
// keeping the path. Deploy: cd tools/redirect && npx wrangler@4 deploy
export default {
  fetch(request, env) {
    const url = new URL(request.url);
    return Response.redirect(env.TARGET + url.pathname + url.search, 301);
  },
};
