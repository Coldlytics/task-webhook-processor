import {
  Color,
  GoogleSpreadsheet,
  GoogleSpreadsheetCell,
  GoogleSpreadsheetWorksheet,
} from "google-spreadsheet";
import axios from "axios";
import { SQSEvent } from "aws-lambda";

interface Message {
  task_id: string;
  sheet_id: string;
  spreadsheet_id: string;
  webhook: string;
}

export async function handler(event: SQSEvent) {
  for (let i = 0; i < event.Records.length; i++) {
    const record = event.Records[i];
    // Check event source
    if (record.eventSource !== "aws:sqs") {
      throw Error(`Unexpected event source: ${record.eventSource}`);
    }
    const payload = JSON.parse(record.body);
    const message: Message = JSON.parse(payload.Message);
    console.log('Received Payload', JSON.stringify(message));

    const sheet = await getSheet(message.spreadsheet_id, message.sheet_id);
    const [x, y] = await getCompanyNameLoc(sheet);
    const headers = await getHeaders(sheet, y);
    await sheet.loadCells({
      startColumnIndex: 0,
      endColumnIndex: headers.length,
      startRowIndex: y + 1,
      endRowIndex: sheet.rowCount,
    });
    let rows = [];
    for (let i = y + 1; i < sheet.rowCount; i++) {
      let row = {
        first_name: "",
        last_name: "",
        company_name: "",
        job_title: "",
        email: "",
        email_status: "",
        domain: "",
        extra: {},
      };
      const companyName = sheet.getCell(i, x).value;
      if (!companyName) {
        break;
      }
      for (let j = 0; j < headers.length; j++) {
        const header = headers[j];
        const cell = sheet.getCell(i, j);
        switch (header) {
          case "First Name":
            row.first_name = `${cell.value}`;
            break;
          case "Last Name":
            row.last_name = `${cell.value}`;
            break;
          case "company_name":
            row.company_name = `${cell.value}`;
            break;
          case "Job Title":
            row.job_title = `${cell.value}`;
            break;
          case "Email Address":
            row.email = `${cell.value}`;
            row.email_status = getEmailStatus(cell);
            break;
          case "Company Website":
            row.domain = `${cell.value}`;
            break;
          default:
            row.extra[header] = cell.value ? `${cell.value}` : null;
        }
      }
      rows.push(row);
    }
    try {
      await axios.post(message.webhook, {
        data: rows,
      });
      console.log(
        `Successfully posted to webhook. Task ID: ${message.task_id}`
      );
    } catch (e) {
      console.log(
        `Couldn't post to webhook. Task ID: ${message.task_id}. Error: ${e}`
      );
    }
  }
}

function getEmailStatus(cell: GoogleSpreadsheetCell) {
  const { backgroundColor } = cell.effectiveFormat;
  if (isRed(backgroundColor)) {
    return "invalid";
  } else if (isYellow(backgroundColor)) {
    return "catch-all";
  } else {
    return "valid";
  }
}

function isYellow(color: Color) {
  return color.red && color.green && !color.blue;
}

function isRed(color: Color) {
  return color.red && !color.green && !color.blue;
}

async function getSheet(spreadsheet_id: string, sheet_id: string) {
  // Extract sheet ID from URL
  const doc = new GoogleSpreadsheet(spreadsheet_id);
  await doc.useServiceAccountAuth({
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_SERVICE_ACCOUNT_KEY.replace(/\\n/gm, '\n'),
  });
  await doc.loadInfo();
  const sheet = doc.sheetsById[sheet_id];
  return sheet;
}

async function getCompanyNameLoc(sheet: GoogleSpreadsheetWorksheet) {
  await sheet.loadCells("A1:L100");
  for (let y = 0; y < 100; y++) {
    for (let x = 0; x < 12; x++) {
      const cell = sheet.getCell(y, x);
      if (cell.value === "company_name") {
        return [x, y];
      }
    }
  }
}

async function getHeaders(
  sheet: GoogleSpreadsheetWorksheet,
  headerRow: number
) {
  let headers = [];
  const a1Row = headerRow + 1;
  await sheet.loadCells(`A${a1Row}:${a1Row}`);
  let x = 0;
  while (x < 200) {
    const cell = sheet.getCell(headerRow, x);
    if (!cell.value) {
      break;
    }
    headers.push(`${cell.value}`);
    x++;
  }
  return headers;
}
