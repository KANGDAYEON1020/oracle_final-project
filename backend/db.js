const oracledb = require("oracledb");

const ORACLE_CLIENT_LIB_DIR = "/opt/oracle/instantclient_23_4"; // 하영
//const ORACLE_CLIENT_LIB_DIR = "/opt/oracle/instantclient_23_3"; // 승민

// Thick 모드 활성화 (Oracle Native Network Encryption)
try {
  oracledb.initOracleClient({ libDir: ORACLE_CLIENT_LIB_DIR });
  console.log(`Oracle Thick mode enabled: ${ORACLE_CLIENT_LIB_DIR}`);
} catch (err) {
  console.error(
    `Thick 모드 초기화 실패(${ORACLE_CLIENT_LIB_DIR}):`,
    err.message,
  );
}

// 쿼리 결과를 { KEY: value } 객체로 반환
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
// CLOB 컬럼을 문자열로 자동 변환 (JSON 파싱용)
oracledb.fetchAsString = [oracledb.CLOB];

let pool;

async function initialize() {
  pool = await oracledb.createPool({
    user: process.env.ORACLE_USER,
    password: process.env.ORACLE_PASSWORD,
    connectString: process.env.ORACLE_CONNECTION_STRING,
    poolMin: 2,
    poolMax: 10,
  });
  console.log("Oracle DB pool created");
}

async function close() {
  if (pool) {
    await pool.close(0);
    console.log("Oracle DB pool closed");
  }
}

async function execute(sql, params = [], opts = {}) {
  const { connection, autoCommit, ...executeOpts } = opts || {};

  if (connection) {
    return connection.execute(sql, params, {
      autoCommit: autoCommit ?? false,
      ...executeOpts,
    });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    return await conn.execute(sql, params, {
      autoCommit: autoCommit ?? true,
      ...executeOpts,
    });
  } finally {
    if (conn) await conn.close();
  }
}

async function withTransaction(work) {
  if (typeof work !== "function") {
    throw new TypeError("withTransaction(work) requires a function");
  }

  let conn;
  try {
    conn = await pool.getConnection();
    const result = await work(conn);
    await conn.commit();
    return result;
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch (rollbackErr) {
        console.error("Oracle transaction rollback 실패:", rollbackErr.message);
      }
    }
    throw err;
  } finally {
    if (conn) await conn.close();
  }
}

module.exports = { initialize, close, execute, withTransaction };
