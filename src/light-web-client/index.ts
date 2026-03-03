import { Router } from "@stricjs/router";
import { dir } from "@stricjs/utils";

export default new Router().get("/", () => new Response("Hi"));
export default new Router().get("/", () => new Response("Hi")).get("/*", dir("./public"));
