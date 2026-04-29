/**
 * 羽毛球小程序 - 应用入口
 */
import { log } from "@zos/utils";

const logger = log.getLogger("ace-badminton");

App({
  globalData: {
    version: "1.0.0",
  },
  onCreate(options) {
    logger.log("羽毛球小程序已启动");
  },
  onDestroy(options) {
    logger.log("羽毛球小程序已关闭");
  },
});
